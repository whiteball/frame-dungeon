import type { ContinuousEffect } from './ItemsLoader';
import type { ContinuousEffectSaveData } from './SaveManager';

/**
 * 1 件の持続効果エントリ。同じアイテムを複数回使っても各エントリ独立に保持する。
 */
export interface ActiveContinuousEffect {
    effects: Map<string, number>;
    remainingTurns: number;
    sourceLabel: string;
    resists: string[];
}

/**
 * {@link ContinuousEffectManager.tick} が返す期限切れエントリ。
 */
export interface ExpiredContinuousEffect {
    sourceLabel: string;
    effects: Map<string, number>;
    resists: string[];
}

/**
 * 数ターンの能力値変動（continuous）と耐性付与をまとめて管理する共有マネージャ。
 * Player / Enemy の双方が 1 つずつ保持し、各種操作を委譲する。
 */
export class ContinuousEffectManager {
    private active: ActiveContinuousEffect[] = [];

    /**
     * 持続効果を付与する。
     * 既存の同種効果と合算せず、エントリとして独立に保持する。
     * @param effect 持続効果（turns と能力値変動、任意で resist）
     * @param sourceLabel 効果の発生源（アイテム名など。ログとUI表示に使用）
     * @returns 能力値名 → 加算量
     */
    apply(effect: ContinuousEffect, sourceLabel: string): Map<string, number> {
        const effects = new Map<string, number>();
        for (const [statName, value] of Object.entries(effect)) {
            if (statName === 'turns' || statName === 'resist') continue;
            if (typeof value !== 'number') continue;
            effects.set(statName, value);
        }
        const resists = Array.isArray(effect.resist) ? [...effect.resist] : [];
        if ((effects.size === 0 && resists.length === 0) || effect.turns <= 0) return effects;

        this.active.push({
            effects,
            remainingTurns: effect.turns,
            sourceLabel,
            resists,
        });
        return effects;
    }

    /**
     * 持続効果を1ターン経過させる。残ターン数が0以下になったエントリは自動削除。
     * @returns 期限切れになったエントリの配列
     */
    tick(): ExpiredContinuousEffect[] {
        const expired: ExpiredContinuousEffect[] = [];
        const remaining: ActiveContinuousEffect[] = [];
        for (const entry of this.active) {
            entry.remainingTurns--;
            if (entry.remainingTurns <= 0) {
                expired.push({ sourceLabel: entry.sourceLabel, effects: entry.effects, resists: entry.resists });
            } else {
                remaining.push(entry);
            }
        }
        this.active = remaining;
        return expired;
    }

    /**
     * 全アクティブ持続効果のボーナス合計（能力値名 → 合計変動量）。
     */
    getBonuses(): Map<string, number> {
        const bonuses = new Map<string, number>();
        for (const entry of this.active) {
            for (const [stat, value] of entry.effects) {
                bonuses.set(stat, (bonuses.get(stat) ?? 0) + value);
            }
        }
        return bonuses;
    }

    /**
     * アクティブな持続効果のディープコピーを返す（UI 表示用スナップショット）。
     */
    getSnapshot(): ActiveContinuousEffect[] {
        return this.active.map(e => ({
            effects: new Map(e.effects),
            remainingTurns: e.remainingTurns,
            sourceLabel: e.sourceLabel,
            resists: [...e.resists],
        }));
    }

    /**
     * 全アクティブ持続効果が付与している耐性 effect 名を平坦化して返す。
     */
    getResists(): string[] {
        const resists: string[] = [];
        for (const entry of this.active) {
            for (const r of entry.resists) resists.push(r);
        }
        return resists;
    }

    /**
     * セーブ用にシリアライズする。
     */
    serialize(): ContinuousEffectSaveData[] {
        return this.active.map(e => ({
            effects: Object.fromEntries(e.effects),
            remainingTurns: e.remainingTurns,
            sourceLabel: e.sourceLabel,
            resists: [...e.resists],
        }));
    }

    /**
     * セーブデータから復元する。旧セーブ互換のため undefined を許容（空として復元）。
     */
    restore(data: ContinuousEffectSaveData[] | undefined): void {
        this.active = (data ?? []).map(e => ({
            effects: new Map(Object.entries(e.effects)),
            remainingTurns: e.remainingTurns,
            sourceLabel: e.sourceLabel,
            resists: Array.isArray(e.resists) ? [...e.resists] : [],
        }));
    }
}

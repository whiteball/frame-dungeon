'use strict';

import { CustomDataStore, YAML_KEYS } from './CustomDataStore';

// ─── セーブデータ型定義 ────────────────────────────────────────────────────────

export interface ItemSaveData {
    instanceId: string;
    name: string;
    quantity: number;
}

export interface ContinuousEffectSaveData {
    effects: Record<string, number>;
    remainingTurns: number;
    sourceLabel: string;
    resists?: string[];
}

export interface StatusEffectSaveData {
    name: string;
    count: number;
}

export interface PlayerSaveData {
    level: number;
    exp: number;
    stats: Record<string, number>;
    maxStats: Record<string, number>;
    inventory: ItemSaveData[];
    equippedWeaponId: string | null;
    equippedMainArmorId: string | null;
    equippedSubArmor1Id: string | null;
    equippedSubArmor2Id: string | null;
    activeContinuousEffects: ContinuousEffectSaveData[];
    activeStatusEffects: StatusEffectSaveData[];
    learnedSkills: string[];
}

export type MapObjectSaveData =
    | { type: 'stairs'; x: number; y: number }
    | { type: 'trap'; x: number; y: number; trapName: string; visible: boolean }
    | { type: 'item'; x: number; y: number; itemName: string };

export interface EnemySaveData {
    instanceId: string;
    name: string;
    x: number;
    y: number;
    stats: Record<string, number>;
    maxStats: Record<string, number>;
    isDead: boolean;
    target: { x: number; y: number } | null;
}

interface RectData {
    x1: number; y1: number; x2: number; y2: number;
}

export interface DungeonSaveData {
    width: number;
    height: number;
    map: number[];
    mapFog: number[];
    mapWalked: number[];
    playerX: number;
    playerY: number;
    playerDirection: number;
    turnCount: number;
    rooms: RectData[];
    roomsWithCorridors: { room: RectData; corridors: RectData[] }[];
    objects: MapObjectSaveData[];
    enemies: EnemySaveData[];
}

export interface SaveData {
    meta: {
        savedAt: string;
        memo: string;
        gameName: string;
        yamlDigest: string;
    };
    floor: number;
    player: PlayerSaveData;
    dungeon: DungeonSaveData;
}

export interface SlotMeta {
    isEmpty: boolean;
    gameName?: string;
    savedAt?: string;
    memo?: string;
    floor?: number;
}

// ─── SaveManager ──────────────────────────────────────────────────────────────

export class SaveManager {
    /**
     * 全 YAML ファイルのテキストを結合して SHA-256 ダイジェスト（16進文字列）を返す。
     * カスタムデータが設定されている場合はそのテキストを使い、なければ固定パスから fetch する。
     */
    static async calculateDigest(): Promise<string> {
        const texts = await Promise.all(
            YAML_KEYS.map(async (key) => {
                const custom = CustomDataStore.get(key);
                if (custom !== undefined) return custom;
                const res = await fetch(`/data/${key}.yml`);
                return res.text();
            })
        );
        const combined = texts.join('\n---\n');
        const encoded = new TextEncoder().encode(combined);
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    static slotKey(slot: number): string {
        return `gameSaves_${String(slot).padStart(2, '0')}`;
    }

    static saveToSlot(slot: number, data: SaveData): void {
        if (slot < 1 || slot > 10) throw new Error(`無効なスロット番号です: ${slot}`);
        try {
            localStorage.setItem(this.slotKey(slot), JSON.stringify(data));
        } catch {
            throw new Error('セーブに失敗しました。LocalStorage の空き容量が不足している可能性があります。');
        }
    }

    static loadFromSlot(slot: number): SaveData | null {
        const json = localStorage.getItem(this.slotKey(slot));
        if (!json) return null;
        try {
            return JSON.parse(json) as SaveData;
        } catch {
            return null;
        }
    }

    static getSlotMeta(slot: number): SlotMeta {
        const data = this.loadFromSlot(slot);
        if (!data) return { isEmpty: true };
        return {
            isEmpty: false,
            gameName: data.meta.gameName,
            savedAt: data.meta.savedAt,
            memo: data.meta.memo,
            floor: data.floor,
        };
    }

    static getAllSlotMeta(): SlotMeta[] {
        return Array.from({ length: 10 }, (_, i) => this.getSlotMeta(i + 1));
    }
}

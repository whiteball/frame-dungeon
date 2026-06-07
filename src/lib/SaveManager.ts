'use strict';

import { CustomDataStore, YAML_KEYS } from './CustomDataStore';

// ─── セーブデータ型定義 ────────────────────────────────────────────────────────

export interface ItemSaveData {
    instanceId: string;
    name: string;
    quantity: number;
    /** 修飾状態（modifier）。name → count。欠落時は空として扱う（旧セーブ互換） */
    modifiers?: Record<string, number>;
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
    /** 手動で無効化中のトグルスキル名。旧セーブ互換のため optional（欠落時は全て有効として復元） */
    disabledSkills?: string[];
    /** 倒した敵の累積数。旧セーブ互換のため optional（欠落時は 0 として復元） */
    enemiesDefeated?: number;
    /** 使ったアイテムの累積数。旧セーブ互換のため optional（欠落時は 0 として復元） */
    itemsUsed?: number;
}

export type MapObjectSaveData =
    | { type: 'stairs'; x: number; y: number }
    | { type: 'trap'; x: number; y: number; trapName: string; visible: boolean }
    /**
     * type: 'item' は新旧フォーマットの両方を受理する。
     * - 新形式: item に ItemSaveData を持つ（modifier 対応）
     * - 旧形式: itemName のみ。deserialize 時にデフォルトの Item として復元
     */
    | { type: 'item'; x: number; y: number; itemName?: string; item?: ItemSaveData }
    | { type: 'treasure'; x: number; y: number; item: ItemSaveData; trapRate: number; trapPool: string[] }
    | {
        type: 'event';
        x: number;
        y: number;
        eventName: string;
        /**
         * `unlock_door: self` action 用の連動扉座標。
         * 鍵 (`secret_room_key`) のような特定の扉と紐付けられた EventObject 用。
         */
        linkedDoor?: { x: number; y: number; dir: number };
      };

export interface EnemySaveData {
    instanceId: string;
    name: string;
    x: number;
    y: number;
    stats: Record<string, number>;
    maxStats: Record<string, number>;
    isDead: boolean;
    target: { x: number; y: number } | null;
    activeStatusEffects?: StatusEffectSaveData[];
    /** 持続効果（continuous）。旧セーブ互換のため optional（欠落時は空として復元） */
    activeContinuousEffects?: ContinuousEffectSaveData[];
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
    floorStartTurnCount?: number;
    rooms: RectData[];
    roomsWithCorridors: { room: RectData; corridors: RectData[] }[];
    objects: MapObjectSaveData[];
    enemies: EnemySaveData[];
    /** 壁に偽装中の隠し扉キー（形式 "x,y,dir"、両側 2 エントリ） */
    disguisedDoors?: string[];
    /** 施錠中の扉キー（形式 "x,y,dir"、両側 2 エントリ）。鍵オブジェクトの調査で解錠される */
    lockedDoors?: string[];
    /** 隠し部屋の領域（オブジェクト配置除外用） */
    secretRoomRects?: RectData[];
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
                const res = await fetch(`${import.meta.env.BASE_URL}data/${key}.yml`);
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

    /**
     * ローカル時刻で `frame_dungeon_YYYYMMDD_HHMMSS.sav` 形式のファイル名を生成する。
     */
    static buildExportFilename(date: Date = new Date()): string {
        const pad2 = (n: number) => String(n).padStart(2, '0');
        const y = date.getFullYear();
        const mo = pad2(date.getMonth() + 1);
        const d = pad2(date.getDate());
        const h = pad2(date.getHours());
        const mi = pad2(date.getMinutes());
        const s = pad2(date.getSeconds());
        return `frame_dungeon_${y}${mo}${d}_${h}${mi}${s}.sav`;
    }

    /**
     * SaveData を JSON テキスト化してローカルファイルとしてダウンロードさせる。
     * Firefox は <a> が DOM ツリーに無いと .click() が無視されるケースがあるため、
     * 必ず body に append → click → remove の順で実行する。
     */
    static downloadSaveFile(saveData: SaveData, filename?: string): void {
        const text = JSON.stringify(saveData);
        const blob = new Blob([text], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename ?? this.buildExportFilename();
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    /**
     * インポートされたテキストを SaveData にパースする。
     * 形式不正の場合は Error を投げる。
     */
    static parseImportedText(text: string): SaveData {
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new Error('セーブデータの形式が不正です');
        }
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('セーブデータの内容が不正です');
        }
        const obj = parsed as Record<string, unknown>;
        const meta = obj.meta as Record<string, unknown> | undefined;
        if (
            !meta ||
            typeof meta.savedAt !== 'string' ||
            typeof meta.gameName !== 'string' ||
            typeof meta.yamlDigest !== 'string' ||
            typeof obj.floor !== 'number' ||
            !obj.player || typeof obj.player !== 'object' ||
            !obj.dungeon || typeof obj.dungeon !== 'object'
        ) {
            throw new Error('セーブデータの内容が不正です');
        }
        return parsed as SaveData;
    }
}

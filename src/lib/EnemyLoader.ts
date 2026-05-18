import { StatsLoader } from './StatsLoader';
import { YamlDefinitionStore } from './YamlDefinitionStore';
import { BaseLoader } from './BaseLoader';
import { CustomDataStore } from './CustomDataStore';

/**
 * 敵が保有するパッシブスキルの1エントリ。
 * skills.yml に trigger: on_attack で定義されたスキルを参照する。
 */
export interface EnemySkillEntry {
    /** skills.yml のスキル名 */
    name: string;
    /** 攻撃時の発動確率 (0–1) */
    rate: number;
}

/**
 * 敵を倒したときのドロップ1エントリ。
 * base.yml floor の enemyDropPool と enemies.yml の drop[] は additive に評価される。
 */
export interface EnemyDropEntry {
    /** items.yml のアイテム名 */
    item: string;
    /** ドロップ確率 (0–1) */
    rate: number;
    /**
     * このドロップに対する modifier 付与確率の上書き (0–1)。
     * 未指定の場合は floor 設定の itemModifierChance を使用。
     */
    modifierChance?: number;
}

export interface EnemyDefinition {
    /**
     * 敵内部ID（英語）
     */
    name: string;
    /**
     * 敵表示名（日本語）
     */
    label: string;
    /**
     * 倒した時の経験値
     */
    exp: number;
    /**
     * 表示色（16進数）
     */
    color?: number;
    /**
     * 敵の説明文
     */
    description: string;
    /**
     * 移動パターン。未指定時は 'default' として扱う
     * 'default': 扉を目標にゾーン内巡回・プレイヤー追跡
     * 'random': ランダムウォーク
     * 'none': 移動しない（隣接時のみ攻撃）
     */
    walk?: 'random' | 'none' | 'default';
    /**
     * この敵が新規付与を阻止する effect 名の配列
     */
    resist?: string[];
    /**
     * 敵が保有するパッシブスキルリスト（trigger: on_attack）
     */
    skills?: EnemySkillEntry[];
    /**
     * 敵を倒したときの追加ドロップ。base.yml floor の enemyDropPool と additive に合成される。
     * 各エントリは独立に rate で判定される。
     */
    drop?: EnemyDropEntry[];
    /**
     * ステータス値（stats.ymlのnameをキーとする）
     * 例: { life: 20, power: 5, defense: 2 }
     */
    [statName: string]: string | number | string[] | EnemySkillEntry[] | EnemyDropEntry[] | undefined;
}

const NON_RANK_FIELDS = new Set(['name', 'label', 'description', 'walk', 'color', 'resist', 'skills', 'drop']);

export class EnemyLoader {
    private static instance: EnemyLoader;
    private store = new YamlDefinitionStore<EnemyDefinition>();
    private minRank = 0;
    private maxRank = 0;

    private constructor() {}

    static getInstance(): EnemyLoader {
        if (!this.instance) {
            this.instance = new EnemyLoader();
        }
        return this.instance;
    }

    async loadEnemies(): Promise<void> {
        const customText = CustomDataStore.get('enemies');
        await this.store.load(`${import.meta.env.BASE_URL}data/enemies.yml`, '敵', enemy => this.validateEnemyDefinition(enemy), { customText });

        const allEnemies = this.store.getAll();
        for (const enemy of allEnemies) {
            let rank = 0;
            for (const [k, v] of Object.entries(enemy)) {
                if (!NON_RANK_FIELDS.has(k) && typeof v === 'number') {
                    rank += v;
                }
            }
            (enemy as Record<string, unknown>)['rank'] = rank;
        }
        const ranks = allEnemies.map(e => (e['rank'] as number) ?? 0);
        this.minRank = ranks.length > 0 ? Math.min(...ranks) : 0;
        this.maxRank = ranks.length > 0 ? Math.max(...ranks) : 0;
    }

    private validateEnemyDefinition(enemy: any): void {
        if (!enemy.name || typeof enemy.name !== 'string') {
            throw new Error(`Invalid enemy: missing or invalid 'name' field`);
        }
        if (!enemy.label || typeof enemy.label !== 'string') {
            throw new Error(`Invalid enemy '${enemy.name}': missing or invalid 'label' field`);
        }
        if (typeof enemy.exp !== 'number' || enemy.exp < 0) {
            throw new Error(`Invalid enemy '${enemy.name}': invalid 'exp' field. Must be a non-negative number`);
        }
        if (!enemy.description || typeof enemy.description !== 'string') {
            throw new Error(`Invalid enemy '${enemy.name}': missing or invalid 'description' field`);
        }

        // stats.ymlで定義されたステータスのバリデーション
        const statsLoader = StatsLoader.getInstance();
        const statNames = statsLoader.getStatNames();
        for (const statName of statNames) {
            if (statName in enemy && typeof enemy[statName] !== 'number') {
                throw new Error(`Invalid enemy '${enemy.name}': '${statName}' must be a number`);
            }
        }

        // skills フィールドのバリデーション
        if (enemy.skills !== undefined) {
            if (!Array.isArray(enemy.skills)) {
                throw new Error(`Invalid enemy '${enemy.name}': 'skills' must be an array`);
            }
            for (let i = 0; i < enemy.skills.length; i++) {
                const s = enemy.skills[i];
                if (!s || typeof s !== 'object') {
                    throw new Error(`Invalid enemy '${enemy.name}': skills[${i}] must be an object`);
                }
                if (typeof s.name !== 'string') {
                    throw new Error(`Invalid enemy '${enemy.name}': skills[${i}].name must be a string`);
                }
                if (typeof s.rate !== 'number' || s.rate < 0 || s.rate > 1) {
                    throw new Error(`Invalid enemy '${enemy.name}': skills[${i}].rate must be a number between 0 and 1`);
                }
            }
        }

        if (enemy.walk !== undefined) {
            if (!['random', 'none', 'default'].includes(enemy.walk)) {
                throw new Error(`Invalid enemy '${enemy.name}': 'walk' must be 'random', 'none', or 'default'`);
            }
        }

        if (enemy.resist !== undefined) {
            if (!Array.isArray(enemy.resist) || enemy.resist.some((r: unknown) => typeof r !== 'string')) {
                throw new Error(`Invalid enemy '${enemy.name}': 'resist' must be an array of strings`);
            }
        }

        if (enemy.drop !== undefined) {
            if (!Array.isArray(enemy.drop)) {
                throw new Error(`Invalid enemy '${enemy.name}': 'drop' must be an array`);
            }
            for (let i = 0; i < enemy.drop.length; i++) {
                const d = enemy.drop[i];
                if (!d || typeof d !== 'object') {
                    throw new Error(`Invalid enemy '${enemy.name}': drop[${i}] must be an object`);
                }
                if (typeof d.item !== 'string' || !d.item) {
                    throw new Error(`Invalid enemy '${enemy.name}': drop[${i}].item must be a non-empty string`);
                }
                if (typeof d.rate !== 'number' || d.rate < 0 || d.rate > 1) {
                    throw new Error(`Invalid enemy '${enemy.name}': drop[${i}].rate must be a number between 0 and 1`);
                }
                if (d.modifierChance !== undefined
                    && (typeof d.modifierChance !== 'number' || d.modifierChance < 0 || d.modifierChance > 1)) {
                    throw new Error(`Invalid enemy '${enemy.name}': drop[${i}].modifierChance must be a number between 0 and 1`);
                }
            }
        }
    }

    getEnemies(): EnemyDefinition[] {
        return this.store.getAll();
    }

    getEnemy(name: string): EnemyDefinition | undefined {
        return this.store.getByName(name);
    }

    getEnemyNames(): string[] {
        return this.store.getNames();
    }

    /**
     * フロアに応じた敵のリストを取得
     * @param floor フロア番号
     * @returns そのフロアで出現する敵の定義リスト
     */
    getEnemiesByFloor(floor: number): EnemyDefinition[] {
        const baseLoader = BaseLoader.getInstance();
        const maxFloor = baseLoader.getGoalFloor();

        return this.store.getAll().filter(enemy => {
            const enemyVars: Record<string, number> = {};
            for (const [k, v] of Object.entries(enemy)) {
                if (typeof v === 'number') enemyVars[k] = v;
            }
            return baseLoader.isEnemySpawnableOnFloor(
                enemyVars,
                floor,
                maxFloor,
                { rank: (enemy['rank'] as number) ?? 0, minRank: this.minRank, maxRank: this.maxRank }
            );
        });
    }

    /**
     * フロアに応じたボス敵を取得
     * @param floor フロア番号
     * @returns ボス敵の定義、存在しない場合はundefined
     */
    getBossForFloor(floor: number): EnemyDefinition | undefined {
        // 5フロアごとにボス出現
        if (floor % 5 !== 0) {
            return undefined;
        }

        // フロアに応じたボスを選択
        if (floor <= 5) {
            return this.getEnemy('ogre');
        } else {
            return this.getEnemy('dragon');
        }
    }

    /**
     * ランダムな敵を取得
     * @param floor フロア番号
     * @returns ランダムに選ばれた敵の定義
     */
    getRandomEnemy(floor: number): EnemyDefinition | undefined {
        const enemies = this.getEnemiesByFloor(floor);
        if (enemies.length === 0) {
            return undefined;
        }

        const index = Math.floor(Math.random() * enemies.length);
        return enemies[index];
    }
}

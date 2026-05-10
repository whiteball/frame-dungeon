import { StatsLoader } from './StatsLoader';
import { YamlDefinitionStore } from './YamlDefinitionStore';
import { BaseLoader } from './BaseLoader';
import { CustomDataStore } from './CustomDataStore';

/**
 * 攻撃時に確率で状態異常を付与する追加効果
 */
export interface EffectAttackSpec {
    name: string;
    rate: number;
}

/**
 * 敵の追加能力（ability）の単一エントリ
 * 現在は effectAttack のみサポート。将来的なタイプ拡張も同パターンで可能
 */
export interface EnemyAbility {
    effectAttack?: EffectAttackSpec;
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
     * 敵の追加能力リスト
     */
    ability?: EnemyAbility[];
    /**
     * 移動パターン。未指定時は 'default' として扱う
     * 'default': 扉を目標にゾーン内巡回・プレイヤー追跡
     * 'random': ランダムウォーク
     * 'none': 移動しない（隣接時のみ攻撃）
     */
    walk?: 'random' | 'none' | 'default';
    /**
     * ステータス値（stats.ymlのnameをキーとする）
     * 例: { life: 20, power: 5, defense: 2 }
     */
    [statName: string]: string | number | EnemyAbility[] | undefined;
}

const NON_RANK_FIELDS = new Set(['name', 'label', 'description', 'walk', 'color', 'ability']);

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
        await this.store.load('/data/enemies.yml', '敵', enemy => this.validateEnemyDefinition(enemy), { customText });

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

        // ability フィールドのバリデーション
        if (enemy.ability !== undefined) {
            if (!Array.isArray(enemy.ability)) {
                throw new Error(`Invalid enemy '${enemy.name}': 'ability' must be an array`);
            }
            for (let i = 0; i < enemy.ability.length; i++) {
                const ab = enemy.ability[i];
                if (!ab || typeof ab !== 'object') {
                    throw new Error(`Invalid enemy '${enemy.name}': ability[${i}] must be an object`);
                }
                let recognized = false;
                if (ab.effectAttack !== undefined) {
                    recognized = true;
                    if (typeof ab.effectAttack !== 'object' || ab.effectAttack === null) {
                        throw new Error(`Invalid enemy '${enemy.name}': ability[${i}].effectAttack must be an object`);
                    }
                    if (typeof ab.effectAttack.name !== 'string') {
                        throw new Error(`Invalid enemy '${enemy.name}': ability[${i}].effectAttack.name must be a string`);
                    }
                    if (typeof ab.effectAttack.rate !== 'number' || ab.effectAttack.rate < 0 || ab.effectAttack.rate > 1) {
                        throw new Error(`Invalid enemy '${enemy.name}': ability[${i}].effectAttack.rate must be a number between 0 and 1`);
                    }
                }
                if (!recognized) {
                    console.warn(`Enemy '${enemy.name}': ability[${i}] has no recognized type key`);
                }
            }
        }

        if (enemy.walk !== undefined) {
            if (!['random', 'none', 'default'].includes(enemy.walk)) {
                throw new Error(`Invalid enemy '${enemy.name}': 'walk' must be 'random', 'none', or 'default'`);
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

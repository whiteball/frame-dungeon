import yaml from 'js-yaml';
import { StatsLoader } from './StatsLoader';

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

export class EnemyLoader {
    private static instance: EnemyLoader;
    private enemies: EnemyDefinition[] = [];
    private enemiesByName: Map<string, EnemyDefinition> = new Map();

    private constructor() {}

    static getInstance(): EnemyLoader {
        if (!this.instance) {
            this.instance = new EnemyLoader();
        }
        return this.instance;
    }

    async loadEnemies(): Promise<void> {
        try {
            const response = await fetch('/data/enemies.yml');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const yamlText = await response.text();
            if (!yamlText.trim()) {
                throw new Error('enemies.yml is empty');
            }

            const parsed = yaml.load(yamlText) as EnemyDefinition[];
            if (!Array.isArray(parsed) || parsed.length === 0) {
                throw new Error('enemies.yml does not contain valid enemy definitions');
            }

            // 敵定義の検証
            for (const enemy of parsed) {
                this.validateEnemyDefinition(enemy);
            }

            this.enemies = parsed;
            this.enemiesByName.clear();

            for (const enemy of this.enemies) {
                this.enemiesByName.set(enemy.name, enemy);
            }
        } catch (error) {
            console.error('Failed to load enemies.yml:', error);
            alert(`敵データの読み込みに失敗しました。\n\n` +
                  `public/data/enemies.yml ファイルが正しく配置されており、\n` +
                  `内容が正しい形式であることを確認してください。\n\n` +
                  `エラー詳細: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
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
        return [...this.enemies];
    }

    getEnemy(name: string): EnemyDefinition | undefined {
        return this.enemiesByName.get(name);
    }

    getEnemyNames(): string[] {
        return this.enemies.map(enemy => enemy.name);
    }

    /**
     * フロアに応じた敵のリストを取得
     * @param floor フロア番号
     * @returns そのフロアで出現する敵の定義リスト
     */
    getEnemiesByFloor(floor: number): EnemyDefinition[] {
        // フロアに応じて敵の強さをフィルタリング
        // floor 1-2: life 40以下
        // floor 3-5: life 60以下
        // floor 6-9: life 100以下
        // floor 10+: 全ての敵

        let maxLife: number;
        if (floor <= 2) {
            maxLife = 40;
        } else if (floor <= 5) {
            maxLife = 60;
        } else if (floor <= 9) {
            maxLife = 100;
        } else {
            return [...this.enemies]; // 全ての敵
        }

        return this.enemies.filter(enemy => {
            const life = enemy['life'];
            return typeof life === 'number' && life <= maxLife;
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

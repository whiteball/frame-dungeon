import yaml from 'js-yaml';

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
     * HP
     */
    hp: number;
    /**
     * 攻撃力
     */
    power: number;
    /**
     * 防御力
     */
    defense: number;
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
        if (typeof enemy.hp !== 'number' || enemy.hp <= 0) {
            throw new Error(`Invalid enemy '${enemy.name}': invalid 'hp' field. Must be a positive number`);
        }
        if (typeof enemy.power !== 'number' || enemy.power < 0) {
            throw new Error(`Invalid enemy '${enemy.name}': invalid 'power' field. Must be a non-negative number`);
        }
        if (typeof enemy.defense !== 'number' || enemy.defense < 0) {
            throw new Error(`Invalid enemy '${enemy.name}': invalid 'defense' field. Must be a non-negative number`);
        }
        if (typeof enemy.exp !== 'number' || enemy.exp < 0) {
            throw new Error(`Invalid enemy '${enemy.name}': invalid 'exp' field. Must be a non-negative number`);
        }
        if (!enemy.description || typeof enemy.description !== 'string') {
            throw new Error(`Invalid enemy '${enemy.name}': missing or invalid 'description' field`);
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
        // floor 1-2: HP 40以下
        // floor 3-5: HP 60以下
        // floor 6-9: HP 100以下
        // floor 10+: 全ての敵

        let maxHp: number;
        if (floor <= 2) {
            maxHp = 40;
        } else if (floor <= 5) {
            maxHp = 60;
        } else if (floor <= 9) {
            maxHp = 100;
        } else {
            return [...this.enemies]; // 全ての敵
        }

        return this.enemies.filter(enemy => enemy.hp <= maxHp);
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

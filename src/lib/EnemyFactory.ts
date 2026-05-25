import { Enemy } from './Enemy';
import { EnemyLoader } from './EnemyLoader';

/**
 * 敵生成ヘルパー。
 *
 * enemies.yml の定義から `Enemy` インスタンスを生成する。
 * 名前指定での個別生成と、フロアプールからのランダム抽選の両方をサポート。
 */
export class EnemyFactory {
    /**
     * 名前指定で敵を生成する。定義が見つからない場合は null。
     */
    static createEnemy(enemyName: string, x: integer, y: integer): Enemy | null {
        const definition = EnemyLoader.getInstance().getEnemy(enemyName);
        if (!definition) {
            console.error(`Enemy definition not found: ${enemyName}`);
            return null;
        }
        return new Enemy(definition, x, y);
    }

    /**
     * フロアに応じたランダムな敵を作成する。
     * 該当フロアに敵プールが存在しない場合は null。
     */
    static createRandomEnemy(floor: number, x: integer, y: integer): Enemy | null {
        const definition = EnemyLoader.getInstance().getRandomEnemy(floor);
        if (!definition) {
            console.error(`No enemy available for floor ${floor}`);
            return null;
        }
        return new Enemy(definition, x, y);
    }
}

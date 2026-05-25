import { StatsLoader } from './StatsLoader';
import { ItemsLoader } from './ItemsLoader';
import { EnemyLoader } from './EnemyLoader';
import { EffectsLoader } from './EffectsLoader';
import { TrapsLoader } from './TrapsLoader';
import { BaseLoader } from './BaseLoader';
import { SkillsLoader } from './SkillsLoader';
import { ItemModifiersLoader } from './ItemModifiersLoader';
import { EventsLoader } from './EventsLoader';

/**
 * 各 YAML Loader を順次初期化する。
 *
 * 各 Loader は Singleton (`getInstance()`) で常に同じインスタンスを返すが、
 * 内部の定義 Map はここで `load*()` を呼ぶまで空のままになる。
 * ゲーム起動時に Game シーンの `create()` から一度だけ呼ぶ想定。
 */
export class GameDataLoader {
    static async loadAll(): Promise<void> {
        await StatsLoader.getInstance().loadStats();
        await ItemsLoader.getInstance().loadItems();
        await EnemyLoader.getInstance().loadEnemies();
        await EffectsLoader.getInstance().loadEffects();
        await TrapsLoader.getInstance().loadTraps();
        await BaseLoader.getInstance().load();
        await SkillsLoader.getInstance().loadSkills();
        await ItemModifiersLoader.getInstance().load();
        await EventsLoader.getInstance().loadEvents();
    }
}

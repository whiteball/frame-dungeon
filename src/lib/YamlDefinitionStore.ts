import yaml from 'js-yaml';

export class YamlDefinitionStore<T extends { name: string }> {
    private items: T[] = [];
    private itemsByName: Map<string, T> = new Map();

    async load(
        filePath: string,
        dataLabel: string,
        validate: (item: any) => void,
        options?: { required?: boolean }
    ): Promise<void> {
        const required = options?.required ?? false;

        const response = await fetch(filePath);
        if (!response.ok) {
            if (required) {
                this._throwWithAlert(filePath, dataLabel, new Error(`HTTP ${response.status}: ${response.statusText}`));
            }
            console.log(`${filePath} が見つかりません (HTTP ${response.status})。${dataLabel}なしで続行します。`);
            return;
        }

        const yamlText = await response.text();
        if (!yamlText.trim()) {
            if (required) {
                this._throwWithAlert(filePath, dataLabel, new Error(`${filePath} is empty`));
            }
            console.log(`${filePath} が空です。${dataLabel}なしで続行します。`);
            return;
        }

        try {
            const parsed = yaml.load(yamlText) as any;

            if (parsed === null || parsed === undefined) {
                if (required) throw new Error(`${filePath} にデータが定義されていません`);
                console.log(`${filePath} にデータが定義されていません。${dataLabel}なしで続行します。`);
                return;
            }
            if (!Array.isArray(parsed)) {
                throw new Error(`${filePath} does not contain a valid array`);
            }
            if (parsed.length === 0) {
                if (required) throw new Error(`${filePath} の${dataLabel}定義が空の配列です`);
                console.log(`${filePath} の${dataLabel}定義が空の配列です。${dataLabel}なしで続行します。`);
                return;
            }
            for (const item of parsed) {
                validate(item);
            }
            this.items = parsed as T[];
            this.itemsByName = new Map(this.items.map(i => [i.name, i]));
        } catch (error) {
            this._throwWithAlert(filePath, dataLabel, error);
        }
    }

    private _throwWithAlert(filePath: string, dataLabel: string, error: unknown): never {
        console.error(`Failed to load ${filePath}:`, error);
        alert(
            `${dataLabel}データの読み込みに失敗しました。\n\n` +
            `public${filePath} ファイルが正しく配置されており、\n` +
            `内容が正しい形式であることを確認してください。\n\n` +
            `エラー詳細: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
    }

    getAll(): T[] { return [...this.items]; }
    getByName(name: string): T | undefined { return this.itemsByName.get(name); }
    getNames(): string[] { return this.items.map(i => i.name); }
    has(name: string): boolean { return this.itemsByName.has(name); }
}

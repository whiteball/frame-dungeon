export const YAML_KEYS = ['base', 'stats', 'items', 'enemies', 'effects', 'traps', 'skills'] as const;
export type YamlKey = typeof YAML_KEYS[number];

const store: Partial<Record<YamlKey, string>> = {};

export const CustomDataStore = {
    set(key: YamlKey, text: string): void {
        store[key] = text;
    },
    get(key: YamlKey): string | undefined {
        return store[key];
    },
    clear(): void {
        for (const k of YAML_KEYS) {
            delete store[k];
        }
    },
    isCustom(): boolean {
        return YAML_KEYS.some(k => k in store);
    },
};

// Ambient declarations for the BetterNCM plugin environment (CEF 91 page).

declare const betterncm: {
  fs: {
    readFileText(path: string): Promise<string>;
    writeFileText(path: string, content: string): Promise<boolean>;
    /**
     * Binary write. Only ever needed for the dictionary archive; everything
     * else here is text. Confirmed against BetterNCM's own first-party
     * Plugin-Market, which uses exactly this call to write a fetched `.plugin`
     * to disk — so a runtime download of binary data is the mechanism the
     * platform is built on, not something being smuggled past it.
     */
    writeFile(path: string, content: Blob): Promise<boolean>;
    /** Create a directory, including parents. */
    mkdir(path: string): Promise<boolean>;
    exists(path: string): Promise<boolean>;
    /**
     * Entries in a directory. Returns full paths rather than bare names, so
     * callers must not assume either — `editionFromFileName` accepts both.
     */
    readDir(path: string): Promise<string[]>;
  };
  app: {
    getDataPath(): Promise<string>;
    showConsole(show?: boolean): Promise<void>;
  };
  ncm: {
    openUrl(url: string): void;
  };
  utils: {
    waitForElement(selector: string, interval?: number): Promise<HTMLElement | null>;
    debounce<T extends (...args: never[]) => void>(fn: T, wait: number): T;
  };
};

declare const betterncm_native: {
  native_plugin: {
    call(identifier: string, args: readonly unknown[]): string;
    getRegisteredAPIs?(): string[];
  };
};

declare const plugin: {
  onLoad(fn: () => void): void;
  onConfig(fn: () => HTMLElement): void;
  pluginPath?: string;
  manifest?: { version?: string };
};

declare const loadedPlugins: Record<string, { pluginPath?: string } | undefined> | undefined;

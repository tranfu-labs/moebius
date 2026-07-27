import {
  LANGUAGE_PREFERENCE_IPC_CHANNELS,
  isDesktopLocale,
  type DesktopLocale,
} from "./language-preference-contract.js";

export interface LanguagePreferenceBroadcastTarget {
  isDestroyed(): boolean;
  send(channel: string, locale: DesktopLocale): void;
}

export interface LanguagePreferenceIpcDependencies {
  getActiveLocale(): DesktopLocale;
  setActiveLocale(locale: DesktopLocale): void;
  persist(locale: DesktopLocale): Promise<void>;
  getBroadcastTargets(): readonly LanguagePreferenceBroadcastTarget[];
}

export interface LanguagePreferenceIpcHandlers {
  read(): Promise<DesktopLocale>;
  save(candidate: unknown): Promise<DesktopLocale>;
}

export function createLanguagePreferenceIpcHandlers(
  dependencies: LanguagePreferenceIpcDependencies,
): LanguagePreferenceIpcHandlers {
  let saveQueue: Promise<void> = Promise.resolve();

  return {
    async read() {
      return dependencies.getActiveLocale();
    },
    async save(candidate) {
      if (!isDesktopLocale(candidate)) {
        throw new Error("unsupported desktop locale");
      }

      const save = saveQueue.then(async () => {
        await dependencies.persist(candidate);
        dependencies.setActiveLocale(candidate);
        for (const target of dependencies.getBroadcastTargets()) {
          if (!target.isDestroyed()) {
            target.send(LANGUAGE_PREFERENCE_IPC_CHANNELS.changed, candidate);
          }
        }
      });
      saveQueue = save.catch(() => undefined);
      await save;
      return dependencies.getActiveLocale();
    },
  };
}

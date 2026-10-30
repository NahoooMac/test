/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string;
  readonly VITE_YANDEX_JS_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

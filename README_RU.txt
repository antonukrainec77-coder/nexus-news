NEXUS — пакет для GitHub

Содержимое:
- index.html — публичный сайт
- admin.html — админ-панель
- robots.txt — robots.txt
- sitemap.xml — sitemap
- supabase/config.toml — конфигурация Supabase
- supabase/functions/import-rss/index.ts — import-rss v3
- .github/workflows/deploy-supabase-functions.yml — автоматический деплой import-rss через GitHub Actions

ВАЖНО:
1. Папку NEXUS-GITHUB-READY не загружайте как вложенную папку в репозиторий.
2. Через GitHub Desktop откройте локальный репозиторий nexus-news и скопируйте ВСЁ содержимое этой папки прямо в папку локального репозитория.
3. Затем Commit to main → Push origin.
4. В GitHub создайте Actions secret с именем SUPABASE_ACCESS_TOKEN.

Не загружайте import-rss-improved.zip. Он не нужен для работы репозитория.

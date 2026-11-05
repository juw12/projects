
"use strict";
/* ======================================================================
   Together — a private, offline life-planning app for couples.
   Structure: constants -> utils -> pure calculations -> store -> views
   -> dialogs/actions -> boot (normal, demo, probe, self-test).
   ====================================================================== */

const APP_KEY = "together.data";
const SCHEMA_VERSION = 3;
const CLOUD_URL = "https://together-cloud.juw12.workers.dev";
const PUBLIC_APP_URL = "https://juw12.github.io/projects/together/";
const VAPID_PUBLIC_KEY = "BI5Mbc3iZHSwc7OdDDsEUiiznVwY-Hsq-no9Pc4QAjYLiUvlpBaI1LzwaXMtwrJ8cp5epqk-7rARB5MErhl3r9M";
const SOURCE_URL = "https://github.com/juw12/projects/tree/main/apps/together";
const params = new URLSearchParams(location.search);
const capturedErrors = [];
window.addEventListener("error", event => capturedErrors.push(String(event.message)));
window.addEventListener("unhandledrejection", event => capturedErrors.push(String(event.reason)));


// Seeds sample data and sets theme/view from the query string, for screenshots.
// Example: _shot.html?theme=light&view=settings  or  _shot.html?theme=dark&open=1
(async () => {
  const params = new URLSearchParams(location.search);
  await window.rewindReady;
  localStorage.clear();
  await store.reset();

  const wonder = store.data.shows.find((show) => show.title === "The Wonder Years");
  const daria = store.data.shows.find((show) => show.title === "Daria");
  await store.addMemory(wonder.id, "Maria", "Sunday nights with my dad. He'd hum every song and pretend he didn't know the words.");
  await store.addMemory(daria.id, "Priya", "Taped every episode on VHS. The tapes outlived three VCRs.");
  await store.addQuote(wonder.id, "Growing up happens in a heartbeat.");
  await store.toggleRemember(wonder.id);
  await store.setDisplayName("Juwen");

  updateSetting("theme", params.get("theme") || "dark");
  if (params.get("accent")) {
    updateSetting("accent", params.get("accent"));
  }

  if (params.get("open")) {
    await openShow(wonder.id);
  } else {
    await setView(params.get("view") || "browse");
  }
})();

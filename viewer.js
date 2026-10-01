chrome.storage.local.get("schedule").then(({ schedule }) => {
  const img = document.getElementById("img");
  if (schedule) { img.src = schedule; img.hidden = false; }
  else document.getElementById("none").hidden = false;
});

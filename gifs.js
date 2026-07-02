// OpenAir Timesheet Importer — gif registry.
// Loaded as a content script (isolated world) BEFORE content.js, so it exposes
// window.OAI_GIFS for the "surprise" button.
//
// To add a gif: append a { url, alt } entry below. Images are loaded straight from
// the remote CDN URL, so no local files are needed.
//
// Probabilities: set `chance` (a percentage) to pin one; any entry WITHOUT a `chance`
// automatically splits the leftover probability evenly with the other unpinned entries,
// and the total is always normalised to 100% at roll time (see rollGif in content.js).
// That means you can add more gifs later and the odds keep summing to 100% on their own.
window.OAI_GIFS = [
  { url: 'https://cdn3.emoji.gg/emojis/366752-cat.gif',                 alt: 'cat' },
  { url: 'https://cdn3.emoji.gg/emojis/666930-catrun.gif',             alt: 'CatRun' },
  { url: 'https://cdn3.emoji.gg/emojis/257763-dancingcat.gif',         alt: 'DancingCat' },
  { url: 'https://cdn3.emoji.gg/emojis/656926-wiggletailcat.gif',      alt: 'wiggletailcat' },
  { url: 'https://cdn3.emoji.gg/emojis/79967-happy-shiba-tailwag.gif', alt: 'happy_shiba_tailwag' },
  { url: 'https://cdn3.emoji.gg/emojis/136245-sneakycat.gif',          alt: 'sneakycat', chance: 5 },
  { url: 'https://cdn3.emoji.gg/emojis/3516-scubbacat.gif',            alt: 'Scubbacat', chance: 1 },
  { url: 'https://cdn3.emoji.gg/emojis/623251-shocked.gif',            alt: 'shocked',   chance: 1 },
  { url: 'https://cdn3.emoji.gg/emojis/29323-doggorun.gif',            alt: 'Doggorun',  chance: 2 },
];

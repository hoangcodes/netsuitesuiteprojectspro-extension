// OpenAir Timesheet Importer — gif registry.
// Loaded as a content script (isolated world) BEFORE content.js, so it exposes
// window.OAI_GIFS for the "surprise" button.
//
// To add a gif: append a { url, alt } entry below. Images load straight from the remote CDN.
//
// Optional per-entry fields:
//   • chance  – pin a probability (percentage, may be fractional e.g. 0.5). Entries WITHOUT
//               a chance split the leftover evenly; the total is normalised to 100% at roll
//               time (see rollGif in content.js), so adding more gifs later just works.
//   • reward  – a message shown as extra subtext when this gif is rolled (e.g. a prize).
//               Leave it off for normal gifs.
window.OAI_GIFS = [
  { url: 'https://cdn3.emoji.gg/emojis/666930-catrun.gif',                alt: 'catRun', chance: 12},
  { url: 'https://cdn3.emoji.gg/emojis/257763-dancingcat.gif',            alt: 'dancingCat', chance: 16},
  { url: 'https://cdn3.emoji.gg/emojis/656926-wiggletailcat.gif',         alt: 'wiggletailcat', chance: 21},
  { url: 'https://cdn3.emoji.gg/emojis/996211-pikachu.gif',               alt: 'pikachu', chance: 3},
  { url: 'https://cdn3.emoji.gg/emojis/700719-hellokittysleighride.gif',  alt: 'helloKittySleighRide', chance: 10},
  { url: 'https://cdn3.emoji.gg/emojis/281357-christmashellokitty.gif',   alt: 'christmasHelloKitty', chance: 8},
  { url: 'https://cdn3.emoji.gg/emojis/136245-sneakycat.gif',             alt: 'sneakycat', chance: 16},
  { url: 'https://cdn3.emoji.gg/emojis/572505-totoro-bye.gif',               alt: 'totoro',   chance: 7},
  { url: 'https://cdn3.emoji.gg/emojis/29323-doggorun.gif',               alt: 'Doggorun',  chance: 4},
  { url: 'https://cdn3.emoji.gg/emojis/8196-yoshi-bonk.gif',              alt: 'yoshi_bonk', chance: 2 },
  { url: 'https://cdn3.emoji.gg/emojis/13344-cat-wtf.gif',                alt: 'cat_wtf', chance: 1, reward: 'please screenshot this to Q, he owes you a coffee' },
];

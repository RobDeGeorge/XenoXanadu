/* ============================================================================
 *  XenoXanadu — Hangman word bank
 *  ----------------------------------------------------------------------------
 *  Used when the AI is the word-master but no local model is connected (the
 *  hosted site, or before you connect one), and as a fallback if the model
 *  returns something unusable. Plain words, grouped by theme; difficulty is
 *  derived from length at pick time so we don't have to tag each word.
 *
 *  Exposes window.HangmanWords.
 * ========================================================================== */
(function (root) {
  'use strict';

  var BANK = {
    animals: ['otter', 'penguin', 'cheetah', 'platypus', 'mongoose', 'jaguar', 'walrus',
      'octopus', 'flamingo', 'porcupine', 'narwhal', 'chameleon', 'hedgehog', 'armadillo',
      'kangaroo', 'salamander', 'wombat', 'pelican', 'lemur', 'gecko'],
    food: ['waffle', 'burrito', 'lasagna', 'pretzel', 'avocado', 'dumpling', 'croissant',
      'meatball', 'pancake', 'spaghetti', 'cheesecake', 'guacamole', 'cinnamon', 'pickle',
      'noodle', 'mango', 'biscuit', 'omelette', 'cupcake', 'pepperoni'],
    movies: ['gladiator', 'inception', 'jaws', 'frozen', 'avatar', 'titanic', 'matrix',
      'casablanca', 'ghostbusters', 'goodfellas', 'jumanji', 'shrek', 'rocky', 'alien',
      'braveheart', 'whiplash', 'amadeus', 'parasite', 'coco', 'up'],
    places: ['volcano', 'glacier', 'lagoon', 'savanna', 'cathedral', 'lighthouse', 'canyon',
      'harbor', 'observatory', 'meadow', 'fjord', 'oasis', 'tundra', 'rainforest',
      'waterfall', 'plateau', 'archipelago', 'marsh', 'desert', 'reef'],
    science: ['neutron', 'gravity', 'molecule', 'galaxy', 'enzyme', 'photon', 'velocity',
      'asteroid', 'electron', 'mitochondria', 'helium', 'magnet', 'quasar', 'isotope',
      'plasma', 'fossil', 'circuit', 'eclipse', 'genome', 'comet'],
    mixed: ['rhythm', 'whisper', 'jigsaw', 'quartz', 'mango', 'puzzle', 'velvet', 'zigzag',
      'oxygen', 'fjord', 'sphinx', 'banjo', 'cyclone', 'galaxy', 'kayak', 'mammoth',
      'nimbus', 'orbit', 'pixel', 'wizard', 'jackpot', 'voyage', 'thunder', 'mosaic']
  };

  var THEMES = [
    { key: 'mixed', label: 'Surprise me', emoji: '' },
    { key: 'animals', label: 'Animals', emoji: '' },
    { key: 'food', label: 'Food', emoji: '' },
    { key: 'movies', label: 'Movies', emoji: '' },
    { key: 'places', label: 'Places', emoji: '' },
    { key: 'science', label: 'Science', emoji: '' }
  ];

  function themeLabel(key) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].key === key) return THEMES[i].label;
    return 'Mixed';
  }

  // difficulty: 'easy' (<=5), 'medium' (6-8), 'hard' (>=9). Falls back to any.
  function pick(theme, difficulty) {
    var list = (BANK[theme] || BANK.mixed).slice();
    var lo = 0, hi = 99;
    if (difficulty === 'easy') { lo = 3; hi = 5; }
    else if (difficulty === 'medium') { lo = 6; hi = 8; }
    else if (difficulty === 'hard') { lo = 9; hi = 99; }
    var filtered = list.filter(function (w) { return w.length >= lo && w.length <= hi; });
    if (!filtered.length) filtered = list;
    var word = filtered[Math.floor(Math.random() * filtered.length)];
    return { word: word, hint: 'Theme: ' + themeLabel(theme) };
  }

  root.HangmanWords = { BANK: BANK, THEMES: THEMES, pick: pick, themeLabel: themeLabel };
})(typeof window !== 'undefined' ? window : globalThis);

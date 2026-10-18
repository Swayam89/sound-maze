// Project page: the sound key buttons play the same sounds as the game.
import { createAudio } from './audio.js';

const audio = createAudio();

document.querySelectorAll('[data-sound]').forEach((button) => {
  button.addEventListener('click', () => {
    audio.unlock();
    audio.play(button.dataset.sound);
  });
});

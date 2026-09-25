/**
 * The Spore Drift
 * ===============
 * Forty-five specks rise slow through the gloom,
 * swaying like thoughts in a mushroom's room.
 * Pure decoration: no chat, no fuss, they simply float and never talk to us.
 */

const SPORE_COUNT = 45;
const SPORE_COLORS = [
  [0.55, "94,189,110"], // fungal green, the common folk
  [0.75, "125,236,160"], // brighter glow
  [0.88, "232,200,74"], // a golden few
  [1.0, "200,196,220"], // pale ghosts
];

const canvas = document.getElementById("spore-canvas");
const context = canvas.getContext("2d");

class Spore {
  constructor() {
    this.reset(true);
  }

  /** Born anywhere at first, afterwards always from the floor. */
  reset(anywhere) {
    this.x = Math.random() * canvas.width;
    this.y = anywhere ? Math.random() * canvas.height : canvas.height + 10;
    this.size = Math.random() * 2.2 + 0.5;
    this.speed = Math.random() * 0.25 + 0.06;
    this.drift = (Math.random() - 0.5) * 0.12;
    this.phase = Math.random() * Math.PI * 2;
    this.phaseSpeed = Math.random() * 0.007 + 0.003;
    this.opacity = Math.random() * 0.15 + 0.03;
    const roll = Math.random();
    this.color = SPORE_COLORS.find(([chance]) => roll < chance)[1];
  }

  update() {
    this.y -= this.speed;
    this.phase += this.phaseSpeed;
    this.x += this.drift + Math.sin(this.phase) * 0.18;
    if (this.y < -10) this.reset(false);
  }

  draw() {
    context.beginPath();
    context.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    context.fillStyle = `rgba(${this.color},${this.opacity})`;
    context.fill();
  }
}

function fitCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

fitCanvas();
window.addEventListener("resize", fitCanvas);

const spores = Array.from({ length: SPORE_COUNT }, () => new Spore());

(function drift() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (const spore of spores) {
    spore.update();
    spore.draw();
  }
  requestAnimationFrame(drift);
})();

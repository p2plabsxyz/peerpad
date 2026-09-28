// What a first-time visitor lands on instead of three empty panes. Kept small
// on purpose: it is here to show how the three panes feed the preview, not to
// be a template most of which has to be deleted first.
export const STARTER_PROJECT = {
    html: `<main class="card">
  <h1>Hello from PeerPad</h1>
  <p>Edit the HTML, CSS and JavaScript panes. The preview updates as you type.</p>
  <button id="greet">Say hi</button>
</main>`,

    css: `.card {
  max-width: 30rem;
  margin: 3rem auto;
  padding: 2rem;
  border: 1px solid currentColor;
  border-radius: 12px;
  text-align: center;
}

button {
  padding: 0.6rem 1.4rem;
  border: 0;
  border-radius: 8px;
  background: #3b82f6;
  color: #fff;
  font-size: 1rem;
  cursor: pointer;
}`,

    javascript: `const greetings = ['Hi 👋', 'Hello 🌍', 'Hey there ✨'];
const button = document.getElementById('greet');

button.addEventListener('click', () => {
  button.textContent = greetings[Math.floor(Math.random() * greetings.length)];
});`
};

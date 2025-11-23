export default defineContentScript({
  matches: ['*://*.google.com/*'],
  main() {
    console.log(document.documentElement.outerHTML);
    console.log('Hello content.');
  },
});

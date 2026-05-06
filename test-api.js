import { printData } from "./app.js";

console.log("Testing printData API...");

printData(
  "Hello, Printer! \nThis is a test print from the API.\n\nThank you!\n\n\n\n\n",
)
  .then(() => {
    console.log("✓ Print API test passed!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("✗ Print API test failed:", err.message);
    process.exit(1);
  });

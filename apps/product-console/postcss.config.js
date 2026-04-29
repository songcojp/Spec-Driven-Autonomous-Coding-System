import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

export default {
  plugins: [
    tailwindcss({ config: "./apps/product-console/tailwind.config.ts" }),
    autoprefixer(),
  ],
};

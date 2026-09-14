import { installDevelopmentPerformance } from "./developmentPerformance";

if (import.meta.env.DEV) {
  const stop = installDevelopmentPerformance();
  import.meta.hot?.dispose(stop);
}

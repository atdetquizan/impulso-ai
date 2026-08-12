import { Routes } from "@angular/router";

export const routes: Routes = [
  { path: "", pathMatch: "full", redirectTo: "publications" },
  {
    path: "publications",
    loadChildren: () =>
      import("./features/publications/publications.routes").then(
        (module) => module.PUBLICATIONS_ROUTES,
      ),
  },
  {
    path: "packages",
    loadChildren: () =>
      import("./features/packages/packages.routes").then(
        (module) => module.PACKAGES_ROUTES,
      ),
  },
  {
    path: "music",
    loadChildren: () =>
      import("./features/music/music.routes").then(
        (module) => module.MUSIC_ROUTES,
      ),
  },
  {
    path: "settings/tiktok",
    loadChildren: () =>
      import("./features/tiktok/tiktok.routes").then(
        (module) => module.TIKTOK_ROUTES,
      ),
  },
  { path: "**", redirectTo: "publications" },
];

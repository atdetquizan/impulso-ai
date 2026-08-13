import { Routes } from "@angular/router";

export const routes: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./features/public/public-layout.component").then(
        (module) => module.PublicLayoutComponent,
      ),
    children: [
      {
        path: "",
        pathMatch: "full",
        loadComponent: () =>
          import("./features/public/landing.component").then(
            (module) => module.LandingComponent,
          ),
      },
      {
        path: "terms-of-service",
        loadComponent: () =>
          import("./features/public/terms-of-service.component").then(
            (module) => module.TermsOfServiceComponent,
          ),
      },
      {
        path: "privacy-policy",
        loadComponent: () =>
          import("./features/public/privacy-policy.component").then(
            (module) => module.PrivacyPolicyComponent,
          ),
      },
    ],
  },
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
  { path: "auth/callback", redirectTo: "publications" },
  { path: "**", redirectTo: "" },
];

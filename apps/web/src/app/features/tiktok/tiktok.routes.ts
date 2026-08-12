import { Routes } from "@angular/router";

export const TIKTOK_ROUTES: Routes = [
  {
    path: "",
    loadComponent: () => import("./tiktok.component").then((component) => component.TiktokComponent),
  },
  {
    path: "callback",
    loadComponent: () => import("./tiktok.component").then((component) => component.TiktokComponent),
  },
];

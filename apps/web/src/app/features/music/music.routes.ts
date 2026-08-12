import { Routes } from "@angular/router";

export const MUSIC_ROUTES: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./music.component").then(
        (component) => component.MusicComponent,
      ),
  },
];

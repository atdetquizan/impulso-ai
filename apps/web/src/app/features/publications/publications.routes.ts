import { Routes } from "@angular/router";

export const PUBLICATIONS_ROUTES: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./publications.component").then(
        (component) => component.PublicationsComponent,
      ),
  },
];

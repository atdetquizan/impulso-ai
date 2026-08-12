import { Routes } from "@angular/router";

export const PACKAGES_ROUTES: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./packages.component").then(
        (component) => component.PackagesComponent,
      ),
  },
];

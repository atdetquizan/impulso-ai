import { CommonModule } from "@angular/common";
import { Component, OnDestroy, ViewEncapsulation, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import { Subscription, filter } from "rxjs";
import { AuthService } from "./auth.service";
import { WorkspaceStore } from "./workspace.store";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
  ],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.scss",
  encapsulation: ViewEncapsulation.None,
})
export class AppComponent implements OnDestroy {
  readonly auth = inject(AuthService);
  readonly workspace = inject(WorkspaceStore);
  readonly publicRoute = signal(this.isPublicPath(window.location.pathname));
  private readonly router = inject(Router);
  private readonly routerSubscription: Subscription;
  email = "";

  constructor() {
    this.routerSubscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => this.publicRoute.set(this.isPublicPath(event.urlAfterRedirects)));

    void this.auth.ready.then(() => {
      if (this.auth.user()) void this.workspace.initializeWorkspace();
    });
  }

  ngOnDestroy() {
    this.routerSubscription.unsubscribe();
  }

  emailValid() {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim());
  }

  login() {
    return this.workspace.login(this.email);
  }

  logout() {
    return this.workspace.logout();
  }

  private isPublicPath(url: string) {
    const path = url.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
    return path === "/" || path === "/terms-of-service" || path === "/privacy-policy";
  }
}

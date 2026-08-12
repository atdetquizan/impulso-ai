import { CommonModule } from "@angular/common";
import { Component, ViewEncapsulation, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
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
export class AppComponent {
  readonly auth = inject(AuthService);
  readonly workspace = inject(WorkspaceStore);
  email = "";

  constructor() {
    void this.auth.ready.then(() => {
      if (this.auth.user()) void this.workspace.initializeWorkspace();
    });
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
}

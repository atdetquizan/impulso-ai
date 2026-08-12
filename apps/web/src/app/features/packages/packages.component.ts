import { CommonModule } from "@angular/common";
import { Component, inject } from "@angular/core";
import { WorkspaceStore } from "../../workspace.store";

@Component({
  selector: "app-packages",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./packages.component.html",
  styleUrl: "./packages.component.scss",
})
export class PackagesComponent {
  readonly store = inject(WorkspaceStore);
}

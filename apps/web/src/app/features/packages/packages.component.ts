import { CommonModule } from "@angular/common";
import { Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { WorkspaceStore } from "../../workspace.store";

@Component({
  selector: "app-packages",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./packages.component.html",
  styleUrl: "./packages.component.scss",
})
export class PackagesComponent {
  readonly store = inject(WorkspaceStore);
}

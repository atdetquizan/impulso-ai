import { CommonModule } from "@angular/common";
import { Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { WorkspaceStore } from "../../workspace.store";

@Component({
  selector: "app-publications",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./publications.component.html",
  styleUrl: "./publications.component.scss",
})
export class PublicationsComponent {
  readonly store = inject(WorkspaceStore);
}

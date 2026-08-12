import { CommonModule } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
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
  readonly copiedErrorId = signal<string | null>(null);

  async copyError(id: string, message: string | null) {
    const detail = message?.trim() || "No se recibió un detalle técnico.";
    await navigator.clipboard.writeText(`Publicación: ${id}\nError: ${detail}`);
    this.copiedErrorId.set(id);
    window.setTimeout(() => this.copiedErrorId.set(null), 1800);
  }
}

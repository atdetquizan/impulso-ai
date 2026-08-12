import { CommonModule } from "@angular/common";
import { Component, inject, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { WorkspaceStore } from "../../workspace.store";

@Component({
  selector: "app-music",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./music.component.html",
  styleUrl: "./music.component.scss",
})
export class MusicComponent implements OnInit {
  readonly store = inject(WorkspaceStore);

  ngOnInit() {
    void this.store.loadIntegrations();
  }
}

import { Component, inject, OnInit } from "@angular/core";
import { WorkspaceStore } from "../../workspace.store";

@Component({
  selector: "app-tiktok",
  standalone: true,
  templateUrl: "./tiktok.component.html",
  styleUrl: "./tiktok.component.scss",
})
export class TiktokComponent implements OnInit {
  readonly store = inject(WorkspaceStore);

  ngOnInit() {
    void this.store.loadIntegrations();
  }
}

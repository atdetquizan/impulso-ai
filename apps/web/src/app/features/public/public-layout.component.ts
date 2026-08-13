import { Component, ViewEncapsulation } from "@angular/core";
import { RouterLink, RouterOutlet } from "@angular/router";

@Component({
  selector: "app-public-layout",
  standalone: true,
  imports: [RouterLink, RouterOutlet],
  templateUrl: "./public-layout.component.html",
  styleUrl: "./public-pages.scss",
  encapsulation: ViewEncapsulation.None,
})
export class PublicLayoutComponent {}

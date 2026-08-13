import { Component } from "@angular/core";
import { Meta, Title } from "@angular/platform-browser";
import { RouterLink } from "@angular/router";

@Component({
  selector: "app-landing",
  standalone: true,
  imports: [RouterLink],
  templateUrl: "./landing.component.html",
})
export class LandingComponent {
  constructor(title: Title, meta: Meta) {
    title.setTitle("Impulso IA | Contenido motivacional con control humano");
    meta.updateTag({
      name: "description",
      content: "Crea frases e imágenes con IA, revisa cada pieza, agrega música y programa contenido para TikTok desde un solo lugar.",
    });
  }
}

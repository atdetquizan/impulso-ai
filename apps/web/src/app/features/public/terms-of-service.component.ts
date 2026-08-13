import { Component } from "@angular/core";
import { Meta, Title } from "@angular/platform-browser";
import { LEGAL_CONTACT_EMAIL, LEGAL_LAST_UPDATED } from "./legal.config";

@Component({
  selector: "app-terms-of-service",
  standalone: true,
  templateUrl: "./terms-of-service.component.html",
})
export class TermsOfServiceComponent {
  readonly contactEmail = LEGAL_CONTACT_EMAIL;
  readonly lastUpdated = LEGAL_LAST_UPDATED;

  constructor(title: Title, meta: Meta) {
    title.setTitle("Términos de servicio | Impulso IA");
    meta.updateTag({
      name: "description",
      content: "Condiciones aplicables al acceso y uso de la plataforma Impulso IA.",
    });
  }
}

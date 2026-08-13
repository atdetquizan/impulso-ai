import { Component } from "@angular/core";
import { Meta, Title } from "@angular/platform-browser";
import { LEGAL_CONTACT_EMAIL, LEGAL_LAST_UPDATED } from "./legal.config";

@Component({
  selector: "app-privacy-policy",
  standalone: true,
  templateUrl: "./privacy-policy.component.html",
})
export class PrivacyPolicyComponent {
  readonly contactEmail = LEGAL_CONTACT_EMAIL;
  readonly lastUpdated = LEGAL_LAST_UPDATED;

  constructor(title: Title, meta: Meta) {
    title.setTitle("Política de privacidad | Impulso IA");
    meta.updateTag({
      name: "description",
      content: "Información sobre el tratamiento de datos, integraciones y opciones de privacidad en Impulso IA.",
    });
  }
}

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export function magicLinkEmailTemplate(actionLink: string) {
  const safeActionLink = escapeHtml(actionLink);

  return {
    subject: 'Tu enlace de acceso a Impulso IA',
    text: [
      'Hola,',
      '',
      'Usa este enlace para ingresar a Impulso IA:',
      actionLink,
      '',
      'El enlace es personal y de un solo uso. Si no solicitaste este acceso, ignora este correo.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Accede a Impulso IA</title>
  </head>
  <body style="margin:0;background:#f4efe4;font-family:Arial,Helvetica,sans-serif;color:#17352c;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4efe4;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fffdf8;border:1px solid #dfd4bd;border-radius:20px;overflow:hidden;">
            <tr>
              <td style="height:8px;background:#e9aa2f;"></td>
            </tr>
            <tr>
              <td style="padding:36px 40px 18px;">
                <div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#65766f;">IMPULSO IA</div>
                <h1 style="margin:14px 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:32px;line-height:1.15;color:#17352c;">Tu contenido te espera.</h1>
                <p style="margin:0;font-size:16px;line-height:1.65;color:#52645d;">Recibimos una solicitud para ingresar a tu centro de publicaciones. Usa el botón para continuar de forma segura.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:14px 40px 28px;">
                <a href="${safeActionLink}" style="display:inline-block;background:#176149;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:15px 28px;border-radius:10px;">Ingresar a Impulso IA</a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 40px 36px;">
                <p style="margin:0 0 10px;font-size:13px;line-height:1.55;color:#718079;">Este enlace es personal y de un solo uso. Si no solicitaste este acceso, puedes ignorar el correo.</p>
                <p style="margin:0;font-size:12px;line-height:1.55;color:#8b9691;">Si el botón no funciona, copia y pega esta dirección en tu navegador:<br><a href="${safeActionLink}" style="color:#176149;word-break:break-all;">${safeActionLink}</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}

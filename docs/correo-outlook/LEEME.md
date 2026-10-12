# Correos de alertas desde Outlook (Microsoft 365)

Manda las alertas de Control de Embarques desde un **buzón de Outlook de CESANTONI** con Microsoft Graph.
Exchange Online permite **10,000 destinatarios al día por buzón** (y 30 mensajes por minuto); la función lleva la cuenta del día y no se pasa.

## 1. Sistemas (Microsoft Entra / Exchange)

1. Crear un buzón dedicado, por ejemplo `logistica-avisos@cesantoni.com.mx` (puede ser buzón compartido).
2. Entra ID › Registros de aplicaciones › **Nueva**: «Control de Embarques · correos». Cuenta solo de esta organización.
3. Permisos de API › Microsoft Graph › **Permisos de aplicación** › `Mail.Send` › **Conceder consentimiento de administrador**.
4. Certificados y secretos › **Nuevo secreto de cliente**. Anotar: *Id. de directorio (tenant)*, *Id. de aplicación (cliente)* y el *secreto*.
5. Limitar la aplicación a ese buzón (recomendado), en Exchange Online PowerShell:
   ```
   New-DistributionGroup -Name "Embarques-Remitente" -Type Security -Members logistica-avisos@cesantoni.com.mx
   New-ApplicationAccessPolicy -AppId <Id. de aplicación> -PolicyScopeGroupId Embarques-Remitente -AccessRight RestrictAccess -Description "Solo el buzón de avisos"
   ```

## 2. Firebase (plan Blaze)

```
cd docs/correo-outlook
firebase functions:secrets:set MS_TENANT_ID
firebase functions:secrets:set MS_CLIENT_ID
firebase functions:secrets:set MS_CLIENT_SECRET
firebase deploy --only functions:correoAlertas --project proveedores-cesantoni
```
(El remitente se cambia con el parámetro `BUZON_REMITENTE`; por omisión `logistica-avisos@cesantoni.com.mx`.)

## 3. En el sistema

Configuración › **Correos de alertas**: activar el envío y elegir, por tipo de alerta, qué áreas reciben el correo y correos extra.
Cada alerta muestra el resultado: enviado, sin destinatarios, tope diario, no activado o error.

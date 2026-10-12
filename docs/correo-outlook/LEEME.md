# Correos de alertas desde tu Outlook (Microsoft 365)

Las alertas de Control de Embarques salen **desde `jroman@cesantoni.com.mx`** (no hay que crear otro buzón). Las manda un
**Apps Script** (`Codigo.gs`), igual que en Movimientos, usando Microsoft Graph. Exchange Online permite **10,000 destinatarios al
día por buzón** (y 30 mensajes por minuto); el script lleva la cuenta del día (hora de México) y no se pasa del tope que pongas
(máximo 10,000).

```
Página (alerta) ──► Apps Script (valida tu sesión, lee destinatarios) ──► Microsoft Graph ──► sale de jroman@cesantoni.com.mx
```

## 1. Sistemas (una sola vez, Microsoft Entra / Exchange)

Outlook no deja que un programa mande correo sin que Sistemas lo autorice. Pídeles:

1. Entra ID › Registros de aplicaciones › **Nuevo registro**: «Control de Embarques · correos», solo esta organización.
2. Permisos de API › Microsoft Graph › **Permisos de aplicación** › `Mail.Send` › **Conceder consentimiento de administrador**.
3. Certificados y secretos › **Nuevo secreto de cliente**. Que te pasen: *Id. de directorio (tenant)*, *Id. de aplicación (cliente)*
   y el *valor del secreto*.
4. Limitar la aplicación a tu buzón (para que solo pueda mandar como tú), en Exchange Online PowerShell:
   ```
   New-DistributionGroup -Name "Embarques-Remitente" -Type Security -Members jroman@cesantoni.com.mx
   New-ApplicationAccessPolicy -AppId <Id. de aplicación> -PolicyScopeGroupId Embarques-Remitente -AccessRight RestrictAccess -Description "Solo jroman"
   ```

## 2. Apps Script (tú)

1. https://script.google.com › **Nuevo proyecto** › nombre «Correos Control de Embarques».
2. Borra lo que trae `Código.gs` y pega todo `Codigo.gs` de esta carpeta. Guardar.
3. Configuración del proyecto (engrane) › **Propiedades del script** › agrega:

   | Propiedad | Valor |
   |---|---|
   | `MS_TENANT_ID` | Id. de directorio que te dio Sistemas |
   | `MS_CLIENT_ID` | Id. de aplicación que te dio Sistemas |
   | `MS_CLIENT_SECRET` | Valor del secreto |
   | `REMITENTE` | `jroman@cesantoni.com.mx` |
   | `FIREBASE_API_KEY` | `AIzaSyAb2NEHLxzpW_MmuUavbYnALxjueL1aI84` |
   | `FIREBASE_PROYECTO` | `proveedores-cesantoni` |

4. **Implementar › Nueva implementación** › tipo **Aplicación web** › Ejecutar como: **Yo** · Quién tiene acceso: **Cualquier
   usuario** › Implementar › autoriza los permisos › copia la **URL de la aplicación web** (termina en `/exec`).
   Abierta en el navegador debe responder `{"estado":"ok",…}`.

«Cualquier usuario» es necesario para que la página pueda llamarlo, pero el script **solo manda** si quien genera la alerta tiene
sesión en Control de Embarques con correo verificado, y **solo a los destinatarios guardados** en Configuración (no a los que diga la
petición). Los secretos se quedan en las propiedades del script, nunca en la página.

## 3. En el sistema

Configuración › **Correos de alertas**:

- Pega la URL del script, activa el envío y pon el tope diario (hasta 10,000).
- Por tipo de alerta, marca qué áreas reciben el correo y agrega correos extra. Al guardar se arma la lista de destinatarios
  (también se actualiza sola al dar de alta o baja a un usuario).

Cada alerta muestra el resultado del correo: enviado, sin destinatarios, tope diario, no activado o error (con el detalle).

## Cambios al script

Si cambias `Codigo.gs`: Implementar › **Gestionar implementaciones** › editar › Versión: **Nueva versión** › Implementar. Así la URL
no cambia.

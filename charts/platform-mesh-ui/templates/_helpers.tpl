{{- define "platform-mesh-ui.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "platform-mesh-ui.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "platform-mesh-ui.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "platform-mesh-ui.labels" -}}
app.kubernetes.io/name: {{ include "platform-mesh-ui.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: ui
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: openkcm
{{- end -}}

{{- define "platform-mesh-ui.selectorLabels" -}}
app.kubernetes.io/name: {{ include "platform-mesh-ui.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "platform-mesh-ui.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{- printf "%s/%s:%s" .Values.image.registry .Values.image.repository $tag -}}
{{- end -}}

{{- define "platform-mesh-ui.externalUrl" -}}
{{- $scheme := .Values.ingress.externalScheme | default (ternary "https" "http" .Values.ingress.tls.enabled) -}}
{{- if not (has $scheme (list "http" "https")) -}}
{{- fail "ingress.externalScheme must be http or https" -}}
{{- end -}}
{{ $scheme }}://{{ .Values.ingress.host }}
{{- end -}}

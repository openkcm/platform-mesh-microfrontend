{{- define "openkcm-ui.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "openkcm-ui.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "openkcm-ui.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "openkcm-ui.labels" -}}
app.kubernetes.io/name: {{ include "openkcm-ui.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: ui
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: openkcm
{{- end -}}

{{- define "openkcm-ui.selectorLabels" -}}
app.kubernetes.io/name: {{ include "openkcm-ui.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "openkcm-ui.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{- printf "%s/%s:%s" .Values.image.registry .Values.image.repository $tag -}}
{{- end -}}

{{- define "openkcm-ui.externalUrl" -}}
{{- if .Values.ingress.tls.enabled -}}
https://{{ .Values.ingress.host }}
{{- else -}}
http://{{ .Values.ingress.host }}
{{- end -}}
{{- end -}}

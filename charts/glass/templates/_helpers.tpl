{{- define "glass.name" -}}
{{- printf "%s-glass" .Release.Name | trunc 54 | trimSuffix "-" -}}
{{- end -}}
{{- define "glass.labels" -}}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: glass
{{- end -}}

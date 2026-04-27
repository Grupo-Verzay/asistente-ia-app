"use client";

import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Command,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandEmpty,
    CommandList,
} from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ChevronsUpDown, Check } from "lucide-react";

// Server actions del CRUD (usa la ruta donde lo pegaste)
import { upsertUserAiConfig, setUserDefaults, getUserAiSettings, getUserAiTrialStatus, TrialStatusDTO } from "@/actions/userAiconfig-actions";
import { useEffect, useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { keepOnlyOpenAIProvider } from "../helpers/keepOnlyOpenAIProvider";

type ApiKeyConfiguratorProps = {
    userId: string;
    disabled?: boolean;
    label?: string;
    /** callback opcional luego de guardar por si quieres refrescar datos del padre */
    onSaved?: () => void;
};

type SettingsData = NonNullable<
    Awaited<ReturnType<typeof getUserAiSettings>>["data"]
>;

// ====== Validación ======
const FormSchema = z.object({
    providerId: z.string({ required_error: "Selecciona un proveedor" }).min(1),
    modelId: z.string({ required_error: "Selecciona un modelo" }).min(1),
    apiKey: z
        .string({ required_error: "Ingresa tu API key" })
        .min(8, "La API key es demasiado corta"),
    makeDefaultProvider: z.boolean().optional(),
    makeDefaultModel: z.boolean().optional(),
});

type FormValues = z.infer<typeof FormSchema>;

// ====== Utils ======
function maskKey(key?: string) {
    if (!key) return "";
    const visible = 4;
    if (key.length <= visible) return "*".repeat(Math.max(4, key.length));
    return `${"*".repeat(Math.max(4, key.length - visible))}${key.slice(-visible)}`;
}

export function ApiKeyConfigurator({
    userId,
    disabled,
    label = "API key (por proveedor)",
    onSaved,
}: ApiKeyConfiguratorProps) {
    const [open, setOpen] = useState(false);
    const [providerOpen, setProviderOpen] = useState(false);
    const [modelOpen, setModelOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [settings, setSettings] = useState<SettingsData | null>(null);
    const [trialStatus, setTrialStatus] = useState<TrialStatusDTO | null>(null);

    // Estado de preview (fuera del diálogo)
    const [previewProviderId, setPreviewProviderId] = useState<string | null>(null);
    const [previewApiKey, setPreviewApiKey] = useState<string>("");

    const form = useForm<FormValues>({
        resolver: zodResolver(FormSchema),
        defaultValues: {
            providerId: "",
            modelId: "",
            apiKey: "",
            makeDefaultProvider: true,
            makeDefaultModel: true,
        },
        mode: "onSubmit",
    });

    // Carga inicial
    useEffect(() => {
        (async () => {
            setLoading(true);
            const [res, trialRes] = await Promise.all([
                getUserAiSettings(userId),
                getUserAiTrialStatus(userId),
            ]);
            setLoading(false);
            if (trialRes?.success && trialRes.data) setTrialStatus(trialRes.data);

            if (!res?.success || !res.data) {
                toast.error(res?.message || "No se pudieron cargar los proveedores");
                return;
            }

            const data = res.data;
            const dataFormatted = keepOnlyOpenAIProvider(data)
            setSettings(dataFormatted);

            // Defaults del usuario
            const defProvId = dataFormatted.defaults.defaultProviderId || dataFormatted.providers[0]?.id || "";
            const modelsForDefault =
                dataFormatted.providers.find((p) => p.id === defProvId)?.models || [];
            const defModelId =
                dataFormatted.defaults.defaultAiModelId || modelsForDefault[0]?.id || "";

            form.setValue("providerId", defProvId);
            form.setValue("modelId", defModelId);

            // Prefill apiKey si ya había config para ese provider
            const existingCfg = dataFormatted.configs.find((c) => c.providerId === defProvId);
            if (existingCfg) {
                form.setValue("apiKey", existingCfg.apiKey);
            }

            // Preview inicial (el input arriba que muestra **key)
            setPreviewProviderId(defProvId);
            setPreviewApiKey(existingCfg?.apiKey || "");
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    const providers = settings?.providers || [];
    const currentProviderId = form.watch("providerId");
    const modelsForProvider =
        providers.find((p) => p.id === currentProviderId)?.models || [];

    // Si cambia provider, resetea modelo + llena API key si existe config
    useEffect(() => {
        if (!settings) return;

        const existsModel = modelsForProvider.some(
            (m) => m.id === form.getValues("modelId")
        );
        if (!existsModel) {
            form.setValue("modelId", "");
        }

        const cfg = settings.configs.find((c) => c.providerId === currentProviderId);
        form.setValue("apiKey", cfg?.apiKey || "");

        // actualiza preview (fuera del diálogo)
        setPreviewProviderId(currentProviderId);
        setPreviewApiKey(cfg?.apiKey || "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentProviderId, settings]);

    const submit = async (data: FormValues) => {
        setLoading(true);
        try {
            // 1) API key x usuario x provider (upsert)
            const up = await upsertUserAiConfig({
                userId,
                providerId: data.providerId,
                apiKey: data.apiKey,
                isActive: true,
                makeDefaultProvider: !!data.makeDefaultProvider,
            });

            if (!up.success) {
                toast.error(up.message || "No se pudo guardar la API key");
                setLoading(false);
                return;
            }

            // 2) Defaults (provider/model)
            const setDef = await setUserDefaults({
                userId,
                providerId: data.makeDefaultProvider ? data.providerId : undefined,
                modelId: data.makeDefaultModel ? data.modelId : undefined,
            });

            if (!setDef.success) {
                toast.warning(
                    setDef.message ||
                    "Clave guardada, pero no se pudieron actualizar los valores por defecto."
                );
            } else {
                toast.success("Guardado correctamente.");
            }

            setOpen(false);

            // refresca settings locales
            const ref = await getUserAiSettings(userId);
            if (ref?.success && ref.data) {
                const filtered = keepOnlyOpenAIProvider(ref.data);
                setSettings(filtered);

                const cfg = filtered.configs.find((c: any) => c.providerId === data.providerId);
                setPreviewProviderId(data.providerId);
                setPreviewApiKey(cfg?.apiKey || "");
            }

            onSaved?.();
        } catch (err: any) {
            toast.error(err?.message || "Error guardando configuración");
        } finally {
            setLoading(false);
        }
    };

    // Etiquetas
    const providerLabel =
        providers.find((p) => p.id === form.getValues("providerId"))?.name ||
        "Selecciona un proveedor";
    const modelLabel =
        modelsForProvider.find((m) => m.id === form.getValues("modelId"))?.name ||
        "Selecciona un modelo";

    // Preview label (fuera del diálogo)
    const previewProviderLabel =
        providers.find((p) => p.id === previewProviderId)?.name || "Proveedor";

    const trialExpired = trialStatus?.trialExpired ?? false;
    const isLocked = disabled || trialExpired;

    return (
        <div className="space-y-2">
            {/* Banner de trial */}
            {trialStatus?.isUsingSystemKey && !trialStatus.trialExpired && (
                <div className="flex items-center gap-2 rounded-md border border-yellow-400 bg-yellow-50 dark:bg-yellow-950 dark:border-yellow-700 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-300">
                    <Clock className="w-4 h-4 shrink-0" />
                    <span>
                        Estás usando la API key de prueba. Te {trialStatus.daysRemaining === 1 ? "queda" : "quedan"}{" "}
                        <strong>{trialStatus.daysRemaining} {trialStatus.daysRemaining === 1 ? "día" : "días"}</strong> de prueba gratuita.
                    </span>
                </div>
            )}
            {trialStatus?.trialExpired && (
                <div className="flex items-center gap-2 rounded-md border border-red-400 bg-red-50 dark:bg-red-950 dark:border-red-700 px-3 py-2 text-sm text-red-800 dark:text-red-300">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                        Tu período de prueba gratuita ha vencido. Debes configurar tu propia API key para continuar usando el asistente.
                    </span>
                </div>
            )}

            {/* Input de previsualización (no editable) */}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                    <div className="relative">
                        <Input
                            readOnly
                            disabled={isLocked || loading}
                            value={
                                trialExpired
                                    ? "API key de prueba vencida"
                                    : previewApiKey
                                        ? `${previewProviderLabel}: ${maskKey(previewApiKey)}`
                                        : `${previewProviderLabel}: No configurada`
                            }
                            placeholder="No configurada"
                            className={cn(
                                "pr-28 cursor-pointer bg-muted/40 border-border",
                                trialExpired && "border-red-400 text-red-600 dark:text-red-400",
                                (isLocked || loading) && "cursor-not-allowed opacity-60"
                            )}
                        />
                        <Button
                            type="button"
                            variant={trialExpired ? "destructive" : "secondary"}
                            className="absolute right-1 top-1 h-8"
                            disabled={loading}
                        >
                            {trialExpired ? "Requerida" : "Configurar"}
                        </Button>
                    </div>
                </DialogTrigger>

                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Configurar proveedor y modelo</DialogTitle>
                        <DialogDescription>
                            Guarda la API key por proveedor de OpenAI.
                        </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={form.handleSubmit(submit)} className="grid gap-4 py-2">
                        {/* Provider — estático */}
                        <div className="grid gap-2">
                            <Label>Proveedor</Label>
                            <div className="px-3 py-2 rounded-md border border-border bg-muted text-sm text-muted-foreground">
                                {providerLabel}
                            </div>
                        </div>

                        {/* Model — estático */}
                        <div className="grid gap-2">
                            <Label>Modelo</Label>
                            <div className="px-3 py-2 rounded-md border border-border bg-muted text-sm text-muted-foreground">
                                {modelLabel}
                            </div>
                        </div>

                        {/* API Key */}
                        <div className="grid gap-2">
                            <Label>API key</Label>
                            <Input
                                type="password"
                                placeholder="sk-********************************"
                                {...form.register("apiKey")}
                                className="bg-background border-border"
                                disabled={loading}
                            />
                            {form.formState.errors.apiKey && (
                                <p className="text-xs text-destructive">
                                    {form.formState.errors.apiKey.message}
                                </p>
                            )}
                            <div className="text-sm text-muted-foreground space-y-4 pt-2">
                                <p>Obtén tu API key en el portal de OpenAI:</p>
                                <a
                                    href="https://platform.openai.com/api-keys"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-base underline underline-offset-2 hover:text-foreground transition-colors block mt-4"
                                >
                                    👉 platform.openai.com/api-keys
                                </a>
                            </div>
                        </div>


                        <DialogFooter className="mt-2">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setOpen(false)}
                                disabled={loading}
                            >
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={loading}>
                                {loading ? "Guardando..." : "Guardar"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dashboard } from "@/components/Dashboard";
import { Orders } from "@/components/Orders";
import { AdCosts } from "@/components/AdCosts";
import { Inventory } from "@/components/Inventory";
import { BarChart3, Package, DollarSign, Box } from "lucide-react";

const Index = () => {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">E-Commerce Management System</h1>
          <p className="text-muted-foreground">
            Manage parcel operations, track profits, and control inventory all in one place
          </p>
        </div>

        <Tabs defaultValue="dashboard" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="dashboard" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="orders" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Orders
            </TabsTrigger>
            <TabsTrigger value="ad-costs" className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Ad Costs
            </TabsTrigger>
            <TabsTrigger value="inventory" className="flex items-center gap-2">
              <Box className="h-4 w-4" />
              Inventory
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard">
            <Dashboard />
          </TabsContent>

          <TabsContent value="orders">
            <Orders />
          </TabsContent>

          <TabsContent value="ad-costs">
            <AdCosts />
          </TabsContent>

          <TabsContent value="inventory">
            <Inventory />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Index;
